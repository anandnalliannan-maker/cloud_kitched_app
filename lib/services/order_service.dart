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
    String deliveryUserId,
  ) {
    return _ordersRef
        .where('deliveryId', isEqualTo: deliveryUserId)
        .where('status', isEqualTo: 'assigned')
        .snapshots();
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
}
