import 'package:cloud_firestore/cloud_firestore.dart';

class OrderService {
  OrderService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  CollectionReference<Map<String, dynamic>> get _ordersRef =>
      _firestore.collection('orders');

  Stream<QuerySnapshot<Map<String, dynamic>>> watchOrdersByStatus(String status) {
    return _ordersRef.where('status', isEqualTo: status).snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchOrdersByMenu(String menuId) {
    return _ordersRef.where('publishedMenuId', isEqualTo: menuId).snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchOrdersByStatuses(
    List<String> statuses,
  ) {
    return _ordersRef.where('status', whereIn: statuses).snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchOrdersForCustomer({
    required String customerId,
  }) {
    return _ordersRef.where('customerId', isEqualTo: customerId).snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchAssignedOrdersForDelivery(
    String deliveryPhone,
  ) {
    return _ordersRef.where('status', isEqualTo: 'assigned').snapshots();
  }

  Future<void> assignOrders({
    required List<String> orderIds,
    required String deliveryUserId,
    required String deliveryPhone,
  }) async {
    final batch = _firestore.batch();

    for (final id in orderIds) {
      final ref = _ordersRef.doc(id);
      batch.update(ref, {
        'deliveryId': deliveryUserId,
        'deliveryPhone': deliveryPhone,
        'status': 'assigned',
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
  }

  Future<void> markDelivered(String orderId) {
    return _ordersRef.doc(orderId).update({
      'status': 'delivered',
      'deliveredAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> createOrder({
    required String customerId,
    required String customerPhone,
    required String customerName,
    required List<Map<String, dynamic>> items,
    required int total,
    required String deliveryType,
    Map<String, dynamic>? deliveryAddress,
  }) async {
    if (items.isEmpty) {
      throw StateError('Cart is empty');
    }

    final menuId = _extractMenuId(items.first['id'] as String);
    for (final item in items) {
      final id = item['id'] as String;
      if (_extractMenuId(id) != menuId) {
        throw StateError('Please order from one menu at a time');
      }
    }

    final orderRef = _ordersRef.doc();
    final orderId = _buildOrderId(orderRef.id);

    final autoAssignment = await _findActiveDeliveryForArea(deliveryAddress);

    await _firestore.runTransaction((tx) async {
      final menuRef = _firestore.collection('published_menus').doc(menuId);
      final menuSnap = await tx.get(menuRef);
      if (!menuSnap.exists) {
        throw StateError('Menu not found');
      }

      final menuData = menuSnap.data() as Map<String, dynamic>;
      final expiresAt = menuData['expiresAt'] as Timestamp?;
      if (expiresAt != null && expiresAt.toDate().isBefore(DateTime.now())) {
        throw StateError('Menu expired');
      }

      final itemRefs = <DocumentReference<Map<String, dynamic>>>[];
      final quantities = <String, int>{};

      for (final item in items) {
        final id = item['id'] as String;
        final itemId = _extractItemId(id);
        final qty = item['qty'] as int;
        final itemRef = menuRef.collection('items').doc(itemId);
        itemRefs.add(itemRef);
        quantities[itemId] = qty;
      }

      final snapshots = <DocumentSnapshot<Map<String, dynamic>>>[];
      for (final ref in itemRefs) {
        snapshots.add(await tx.get(ref));
      }

      for (final snap in snapshots) {
        if (!snap.exists) {
          throw StateError('Menu item not found');
        }

        final data = snap.data() as Map<String, dynamic>;
        final available = (data['qty'] ?? 0) as int;
        final name = (data['name'] ?? 'Item') as String;
        final itemId = snap.id;
        final qty = quantities[itemId] ?? 0;

        if (available < qty) {
          throw StateError('Item out of stock: $name');
        }

        tx.update(snap.reference, {
          'qty': available - qty,
        });
      }

      tx.set(orderRef, {
        'orderId': orderId,
        'customerId': customerId,
        'customerPhone': customerPhone,
        'customerName': customerName,
        'items': items,
        'total': total,
        'deliveryType': deliveryType,
        if (deliveryAddress != null) 'deliveryAddress': deliveryAddress,
        'status': autoAssignment == null ? 'new' : 'assigned',
        if (autoAssignment != null) 'deliveryPhone': autoAssignment.phone,
        if (autoAssignment?.userId != null) 'deliveryId': autoAssignment!.userId,
        'publishedMenuId': menuId,
        'createdAt': FieldValue.serverTimestamp(),
      });
    });
  }

  String _extractMenuId(String compositeId) {
    final parts = compositeId.split(':');
    return parts.first;
  }

  String _extractItemId(String compositeId) {
    final parts = compositeId.split(':');
    return parts.length > 1 ? parts[1] : compositeId;
  }

  String _buildOrderId(String docId) {
    final now = DateTime.now();
    final y = now.year.toString().padLeft(4, '0');
    final m = now.month.toString().padLeft(2, '0');
    final d = now.day.toString().padLeft(2, '0');

    final bytes = docId.codeUnits;
    var sum = 0;
    for (final b in bytes) {
      sum = (sum * 31 + b) % 1000000;
    }
    final suffix = sum.toString().padLeft(6, '0');
    return 'CK-$y$m$d-$suffix';
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

  Future<_DeliveryAssignment?> _findActiveDeliveryForArea(
    Map<String, dynamic>? deliveryAddress,
  ) async {
    if (deliveryAddress == null) return null;
    final area = (deliveryAddress['area'] ?? '').toString().trim();
    if (area.isEmpty) return null;

    final data = await _pickAgentForArea(area);
    if (data == null) return null;
    final phone = (data['phone'] ?? '').toString();
    if (phone.isEmpty) return null;

    final savedUserId = (data['userId'] ?? '').toString();
    if (savedUserId.isNotEmpty) {
      return _DeliveryAssignment(phone: phone, userId: savedUserId);
    }

    final candidates = _phoneCandidates(_normalizePhone(phone));
    final userSnap = await _firestore
        .collection('users')
        .where('role', isEqualTo: 'delivery')
        .where('phone', whereIn: candidates)
        .where('approved', isEqualTo: true)
        .where('active', isEqualTo: true)
        .limit(1)
        .get();

    if (userSnap.docs.isEmpty) {
      return _DeliveryAssignment(phone: phone, userId: null);
    }
    return _DeliveryAssignment(phone: phone, userId: userSnap.docs.first.id);
  }

  Future<Map<String, dynamic>?> _pickAgentForArea(String area) async {
    final snap = await _firestore
        .collection('delivery_agents')
        .where('active', isEqualTo: true)
        .get();

    final docs = snap.docs.map((d) => d.data()).toList();
    final primary = docs.where((agent) {
      return (agent['area'] ?? '').toString().trim() == area;
    }).toList();
    if (primary.isNotEmpty) return primary.first;

    final secondary = docs.where((agent) {
      final areas = List<String>.from(
        (agent['secondaryAreas'] as List<dynamic>? ?? const []),
      );
      return areas.any((a) => a.trim() == area);
    }).toList();
    if (secondary.isNotEmpty) return secondary.first;

    return null;
  }
}

class _DeliveryAssignment {
  const _DeliveryAssignment({required this.phone, required this.userId});

  final String phone;
  final String? userId;
}
