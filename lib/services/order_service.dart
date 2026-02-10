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

  Future<void> createOrder({
    required String customerId,
    required String customerPhone,
    required List<Map<String, dynamic>> items,
    required int total,
    required String deliveryType,
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

    await _firestore.runTransaction((tx) async {
      final menuRef = _firestore.collection('published_menus').doc(menuId);
      final menuSnap = await tx.get(menuRef);
      if (!menuSnap.exists) {
        throw StateError('Menu not found');
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

      tx.set(_ordersRef.doc(), {
        'customerId': customerId,
        'customerPhone': customerPhone,
        'items': items,
        'total': total,
        'deliveryType': deliveryType,
        'status': 'new',
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
}
