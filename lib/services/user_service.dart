import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class UserService {
  UserService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  Future<DocumentSnapshot<Map<String, dynamic>>> getCurrentUserDoc() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw StateError('User not signed in');
    }
    return _firestore.collection('users').doc(uid).get();
  }

  Future<void> ensureUserDoc({
    required String role,
    required bool approved,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw StateError('User not signed in');
    }

    final userRef = _firestore.collection('users').doc(user.uid);
    final snap = await userRef.get();

    if (!snap.exists) {
      await userRef.set({
        'role': role,
        'approved': approved,
        'active': true,
        'phone': user.phoneNumber,
        'createdAt': FieldValue.serverTimestamp(),
      });
    }
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchUsers() {
    return _firestore.collection('users').snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchActiveDeliveryUsers() {
    return _firestore
        .collection('users')
        .where('role', isEqualTo: 'delivery')
        .where('approved', isEqualTo: true)
        .where('active', isEqualTo: true)
        .snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchDeliveryAgents() {
    return _firestore
        .collection('delivery_agents')
        .orderBy('createdAt', descending: true)
        .snapshots();
  }

  Future<void> addDeliveryAgent({
    required String name,
    required String phone,
    required String area,
  }) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('User not signed in');

    final normalized = _normalizePhone(phone);
    await _firestore.collection('delivery_agents').doc(normalized).set({
      'name': name,
      'phone': normalized,
      'area': area,
      'active': true,
      'createdBy': user.uid,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    await _reassignOrdersForArea(area);
  }

  Future<void> setDeliveryAgentActive(String phone, bool active) async {
    final normalized = _normalizePhone(phone);
    final candidates = _phoneCandidates(normalized);
    final before = await _firestore.collection('delivery_agents').doc(normalized).get();
    final oldArea = (before.data()?['area'] ?? '').toString();
    await _firestore.collection('delivery_agents').doc(normalized).set({
      'active': active,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    final users = await _firestore
        .collection('users')
        .where('role', isEqualTo: 'delivery')
        .where('phone', whereIn: candidates)
        .get();
    final batch = _firestore.batch();
    for (final doc in users.docs) {
      batch.update(doc.reference, {
        'active': active,
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    if (oldArea.isNotEmpty) {
      await _reassignOrdersForArea(oldArea);
    }
  }

  Future<void> updateDeliveryAgent({
    required String oldPhone,
    required String name,
    required String area,
  }) async {
    final normalized = _normalizePhone(oldPhone);
    final ref = _firestore.collection('delivery_agents').doc(normalized);
    final snap = await ref.get();
    if (!snap.exists) {
      throw StateError('Delivery agent not found');
    }
    final oldArea = (snap.data()?['area'] ?? '').toString();

    await ref.set({
      'name': name,
      'area': area,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    final candidates = _phoneCandidates(normalized);
    final users = await _firestore
        .collection('users')
        .where('role', isEqualTo: 'delivery')
        .where('phone', whereIn: candidates)
        .get();
    final batch = _firestore.batch();
    for (final doc in users.docs) {
      batch.update(doc.reference, {
        'name': name,
        'assignedArea': area,
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    if (oldArea.isNotEmpty) {
      await _reassignOrdersForArea(oldArea);
    }
    await _reassignOrdersForArea(area);
  }

  Future<bool> canRoleLogin({
    required String role,
    required String phone,
  }) async {
    if (role == 'customer') return true;
    final normalized = _normalizePhone(phone);

    if (role == 'delivery') {
      final agent = await _getDeliveryAgentByPhoneCandidates(
        _phoneCandidates(normalized),
      );
      return agent != null;
    }

    if (role == 'owner') {
      return true;
    }

    return false;
  }

  Future<void> syncRoleAccessAfterLogin(String role) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('User not signed in');
    final phone = _normalizePhone(user.phoneNumber ?? '');
    final candidates = _phoneCandidates(phone);
    if (phone.isEmpty) throw StateError('Phone number missing');

    if (role == 'customer') {
      await ensureUserDoc(role: role, approved: true);
      return;
    }

    if (role == 'delivery') {
      final agent = await _getDeliveryAgentByPhoneCandidates(candidates);
      if (agent == null) {
        throw StateError('Contact admin');
      }
      await ensureUserDoc(role: 'delivery', approved: false);
      await _firestore.collection('users').doc(user.uid).set({
        'role': 'delivery',
        'approved': true,
        'active': true,
        'phone': phone,
        'name': (agent['name'] ?? '').toString(),
        'assignedArea': (agent['area'] ?? '').toString(),
        'updatedAt': FieldValue.serverTimestamp(),
        'createdAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

      final normalized = _normalizePhone(phone);
      await _firestore.collection('delivery_agents').doc(normalized).set({
        'userId': user.uid,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      return;
    }

    if (role == 'owner') {
      final selfDoc = await _firestore.collection('users').doc(user.uid).get();
      if (!selfDoc.exists) {
        throw StateError('Contact admin');
      }
      final ownerDoc = selfDoc.data() ?? <String, dynamic>{};
      final isValidOwner = ownerDoc['role'] == 'owner' &&
          ownerDoc['approved'] == true &&
          ownerDoc['active'] != false;
      if (!isValidOwner) {
        throw StateError('Contact admin');
      }
      await _firestore.collection('users').doc(user.uid).set({
        'role': 'owner',
        'approved': true,
        'active': true,
        'phone': phone,
        if (ownerDoc['name'] != null) 'name': ownerDoc['name'],
        'updatedAt': FieldValue.serverTimestamp(),
        'createdAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
  }

  Future<void> setApproved(String uid, bool approved) {
    return _firestore.collection('users').doc(uid).update({
      'approved': approved,
    });
  }

  Future<void> setActive(String uid, bool active) {
    return _firestore.collection('users').doc(uid).update({
      'active': active,
    });
  }

  String _normalizePhone(String raw) {
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 10) return '+91$digits';
    if (digits.length == 12 && digits.startsWith('91')) return '+$digits';
    if (raw.startsWith('+')) return raw;
    return raw;
  }

  List<String> _phoneCandidates(String normalized) {
    final candidates = <String>{};
    candidates.add(normalized);
    final digits = normalized.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 12 && digits.startsWith('91')) {
      final local = digits.substring(2);
      candidates.add(local);
      candidates.add(digits);
      candidates.add('+$digits');
    } else if (digits.length == 10) {
      candidates.add(digits);
      candidates.add('+91$digits');
      candidates.add('91$digits');
    }
    return candidates.take(10).toList();
  }

  Future<Map<String, dynamic>?> _getDeliveryAgentByPhoneCandidates(
    List<String> candidates,
  ) async {
    for (final candidate in candidates) {
      try {
        final doc = await _firestore
            .collection('delivery_agents')
            .doc(candidate)
            .get();
        if (!doc.exists) continue;
        final data = doc.data();
        if (data == null) continue;
        if (data['active'] != true) continue;
        return data;
      } on FirebaseException catch (_) {
        // Try next phone candidate when read is denied for one format.
        continue;
      }
    }
    return null;
  }

  Future<void> _reassignOrdersForArea(String area) async {
    final trimmedArea = area.trim();
    if (trimmedArea.isEmpty) return;

    final agentSnap = await _firestore
        .collection('delivery_agents')
        .where('area', isEqualTo: trimmedArea)
        .where('active', isEqualTo: true)
        .limit(1)
        .get();

    String? deliveryPhone;
    String? deliveryId;
    if (agentSnap.docs.isNotEmpty) {
      final agent = agentSnap.docs.first.data();
      final phone = (agent['phone'] ?? '').toString();
      if (phone.isNotEmpty) {
        deliveryPhone = phone;
      }
      final userId = (agent['userId'] ?? '').toString();
      if (userId.isNotEmpty) {
        deliveryId = userId;
      } else if (deliveryPhone != null) {
        final candidates = _phoneCandidates(_normalizePhone(deliveryPhone));
        final userSnap = await _firestore
            .collection('users')
            .where('role', isEqualTo: 'delivery')
            .where('phone', whereIn: candidates)
            .where('approved', isEqualTo: true)
            .where('active', isEqualTo: true)
            .limit(1)
            .get();
        if (userSnap.docs.isNotEmpty) {
          deliveryId = userSnap.docs.first.id;
        }
      }
    }

    final deliveryOrders = await _firestore
        .collection('orders')
        .where('deliveryType', isEqualTo: 'delivery')
        .get();

    final batch = _firestore.batch();
    for (final doc in deliveryOrders.docs) {
      final data = doc.data();
      final status = (data['status'] ?? '').toString();
      if (status != 'new' && status != 'assigned') continue;
      final addr = data['deliveryAddress'] as Map<String, dynamic>?;
      final orderArea = (addr?['area'] ?? '').toString();
      if (orderArea != trimmedArea) continue;

      if (deliveryPhone == null) {
        batch.update(doc.reference, {
          'status': 'new',
          'deliveryPhone': FieldValue.delete(),
          'deliveryId': FieldValue.delete(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      } else {
        batch.update(doc.reference, {
          'status': 'assigned',
          'deliveryPhone': deliveryPhone,
          if (deliveryId != null) 'deliveryId': deliveryId,
          if (deliveryId == null) 'deliveryId': FieldValue.delete(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
    }
    await batch.commit();
  }
}
